# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This AWS Lambda function generates a Draw.io diagram URL from a given set of nodes and edges.
It takes a graph representation (nodes with hierarchical information and edges) as input,
converts it into a Draw.io-compatible XML format, compresses and encodes the XML,
and then constructs a URL that can be opened directly in Draw.io to display the diagram.
"""

import urllib.parse # Used for URL encoding.
from xml.etree.ElementTree import Element, SubElement, tostring # Used for building XML trees.
from type_definitions import get_type_definitions # Imports function to get type definitions for diagram elements.
from zlib import compress # Used for zlib compression of the XML output.
from base64 import b64encode # Used for Base64 encoding of the compressed data.
from operator import itemgetter # Used for efficiently getting items from dictionaries/objects.

# Standardized drawing margin based on Cytoscape graphing library defaults.
drawing_margin = 30
# Get a dictionary of icon styles and dimensions based on Cytoscape 'types' (from type_definitions.py).
types = get_type_definitions()


class Node:
    """
    Represents a node (e.g., an AWS resource) in the architecture diagram.
    It stores hierarchical information, label, title, and calculates its
    position and dimensions (height, width, x, y coordinates) dynamically
    based on whether it's an end node or a container node with children.
    """

    def __init__(self, node_id, node_type, label, title, center_x, center_y, is_end_node):
        self.node_id = node_id # Unique identifier for the node.
        self.node_type = node_type # Type of the node (e.g., 'vpc', 'ec2').
        self.label = label # Display label for the node.
        self.title = title # Title or detailed name for the node.
        self.center_x = center_x # X-coordinate of the node's center.
        self.center_y = center_y # Y-coordinate of the node's center.
        self.style = types[self.node_type]['style'] # Draw.io style string for the node.
        self.is_end_node = is_end_node # True if it's a leaf node (resource), False if it's a container.
        self.children = [] # List to store child Node objects for hierarchical diagrams.

    @property
    def height(self):
        """
        Calculates the height of the node.
        If it's an end node, uses predefined height from `types`.
        If it's a container node, calculates height based on its children's positions.
        """
        if self.is_end_node and 'height' in types[self.node_type]:
            return types[self.node_type]['height']
        elif len(self.children) == 0:
            return None # No height if no children and not an end node.
        else:
            # Calculate the furthest vertical point covered by children.
            children_points = list(
                filter(None, map(lambda c: (c.height*0.5 + c.center_y), self.children)))
            furthest_point = max(children_points)
            # Height is from the node's top (self.y) to the furthest child point plus margin.
            result = furthest_point + drawing_margin - self.y
            return result

    @property
    def width(self):
        """
        Calculates the width of the node.
        If it's an end node, uses predefined width from `types`.
        If it's a container node, calculates width based on its children's positions.
        """
        if 'width' in types[self.node_type]:
            return types[self.node_type]['width']
        elif len(self.children) == 0:
            return None # No width if no children.
        else:
            # Calculate the furthest horizontal point covered by children.
            children_points = list(
                filter(None, map(lambda c: (c.width*0.5 + c.center_x), self.children)))
            furthest_point = max(children_points)
            # Width is twice the distance from the node's center to the furthest child point plus margin.
            result = 2*(furthest_point + drawing_margin - self.center_x)
            return result

    @property
    def x(self):
        """
        Calculates the X-coordinate of the top-left corner of the node.
        If it's an end node, it's based on its center and width.
        If it's a container node, it's based on its children's positions and margin.
        """
        if self.is_end_node:
            return self.center_x - 0.5*self.width
        elif len(self.children) == 0:
            return None
        else:
            # Calculate the minimum X-coordinate covered by children.
            children_points = list(
                filter(None, map(lambda c: (c.center_x - 0.5*c.width), self.children)))
            min_point = min(children_points)
            # X-coordinate is the minimum child point minus the drawing margin.
            result = (min_point - drawing_margin)
            return result

    @property
    def y(self):
        """
        Calculates the Y-coordinate of the top-left corner of the node.
        If it's an end node, it's based on its center and height.
        If it's a container node, it's based on its children's positions and margin.
        """
        if self.is_end_node:
            return self.center_y - 0.5*self.height
        elif len(self.children) == 0:
            return None
        else:
            # Calculate the minimum Y-coordinate covered by children.
            children_points = list(
                filter(None, map(lambda c: (c.center_y - 0.5*c.height), self.children)))
            min_point = min(children_points)
            # Y-coordinate is the minimum child point minus the drawing margin.
            result = (min_point - drawing_margin)
            return result

    def add_child(self, child):
        """
        Adds a child node to this node's list of children.
        @param child: The child Node object to add.
        """
        self.children.append(child)

    def get_xml_object(self):
        """
        Generates the XML representation of the node for Draw.io.
        This creates an `<object>` element with `mxCell` and `mxGeometry` sub-elements.
        """
        # Attributes for the mxCell element (Draw.io context and style).
        icon = {'style': self.style, 'vertex': '1', 'parent': '1'}
        # Attributes for the object element (node ID, label, and type-specific title).
        content = {
            'id': self.node_id,
            'label': self.label,
            self.node_type: self.title # Dynamic attribute for node type (e.g., 'vpc': 'MyVPC').
        }
        # Attributes for the mxGeometry element (position and dimensions).
        coords = {
            'x': str(self.x),
            'y': str(self.y),
            'height': str(self.height),
            'width': str(self.width),
            'as': 'geometry' # Indicates this is geometry information.
        }
        # Build the XML structure: <object><mxCell><mxGeometry/></mxCell></object>
        obj = Element('object', content)
        styled_obj = SubElement(obj, 'mxCell', icon)
        SubElement(styled_obj, 'mxGeometry', coords) # SubElement mutates styled_obj.

        return obj


class Edge:
    """
    Represents an edge (connection) between two nodes in the architecture diagram.
    It stores the source and target node IDs and its Draw.io style.
    """
    def __init__(self, edge_id, source, target):
        self.edge_id = edge_id # Unique identifier for the edge.
        self.source = source # ID of the source node.
        self.target = target # ID of the target node.
        self.style = types['edge']['style'] # Draw.io style string for edges.

    def get_xml_object(self):
        """
        Generates the XML representation of the edge for Draw.io.
        This creates an `<mxCell>` element with `mxGeometry` sub-element.
        """
        # Attributes for the mxCell element (edge ID, style, parent, source, target).
        content = {
            'id': self.edge_id,
            'style': self.style,
            'parent': '1',
            'source': self.source,
            'target': self.target,
            'edge': '1' # Indicates this is an edge.
        }
        # Attributes for the mxGeometry element (relative positioning).
        coords = {
            'relative': '1',
            'as': 'geometry'
        }
        # Build the XML structure: <mxCell><mxGeometry/></mxCell>
        obj = Element('mxCell', content)
        SubElement(obj, 'mxGeometry', coords) # SubElement mutates obj.

        return obj


def handler(event, _):
    """
    Main AWS Lambda handler function for generating Draw.io diagrams.
    It processes input `nodes` and `edges` from the event, constructs
    Node and Edge objects, builds the XML diagram, compresses and encodes it,
    and returns a URL that can be opened in Draw.io.
    """
    node_dict = dict() # Dictionary to store Node objects, keyed by node_id.

    args = event['arguments']
    nodes = args.get('nodes', []) # List of node data from the input event.
    edges = args.get('edges', []) # List of edge data from the input event.

    # First pass: Create Node objects and populate node_dict.
    for node_data in nodes:
        node_id, node_type, label, title, position = \
            itemgetter('id', 'type', 'label', 'title', 'position')(node_data)

        # Adjust node_type if it's a 'resource' and has an 'image' property.
        if node_type == 'resource' and 'image' in node_data:
            node_type = node_data['image'].split('/')[-1].split('.')[0]

        x = position['x']
        y = position['y']
        is_end_node = node_data['type'] == 'resource' # Determine if it's a leaf node.
        node = Node(node_id, node_type, label, title, x, y, is_end_node)
        node_dict[node_id] = node

    # Second pass: Establish parent-child relationships between nodes.
    for node_data in nodes:
        node_id = node_data['id']
        parent_id = node_data.get('parent')
        if parent_id:
            # Add the current node as a child to its parent node.
            node_dict[parent_id].add_child(node_dict[node_id])

    # Collect all Node objects into a list for XML generation.
    elements = list(node_dict.values())

    # Create Edge objects and add them to the elements list.
    for edge_data in edges:
        edge_id, source, target = itemgetter('id', 'source', 'target')(edge_data)
        edge = Edge(edge_id, source, target)
        elements.append(edge)

    # Produce the raw XML output for the diagram.
    xml_output = produce_xml_output(elements)

    # Compress and Base64 encode the XML tree string.
    xml_output_compressed_encoded = deflate_and_base64_encode(xml_output)
    # URL encode the compressed and encoded string.
    xml_output_url = urllib.parse.quote(xml_output_compressed_encoded, safe='')
    # Attach the XML string to the Draw.io URL.
    # Note: Using `app.diagrams.net` instead of `app.diagram.net` due to .io vulnerabilities.
    drawio_url = 'https://app.diagrams.net?title=AWS%20Architecture%20Diagram.xml#R' + xml_output_url

    return drawio_url


def produce_xml_output(elements):
    """
    Helper function that creates the complete XML tree for the Draw.io diagram.
    It initializes the basic `mxGraphModel` structure and then appends
    the XML representations of all nodes and edges.
    @param elements: A list of Node and Edge objects.
    @return: The XML tree as a byte string.
    """
    # Initialize Parent Nodes in Draw.IO XML Tree.
    xml_model = Element('mxGraphModel')
    root = SubElement(xml_model, 'root')

    # Draw.io needs two default cells to start drawing.
    default_cell_contents = {'id': '0'}
    SubElement(root, 'mxCell', default_cell_contents) # SubElement mutates root.
    default_cell_contents = {'id': '1', 'parent': '0'}
    SubElement(root, 'mxCell', default_cell_contents)

    # Append the XML object for each element (node or edge) to the root.
    for elem in elements:
        xml_object = elem.get_xml_object()
        root.append(xml_object)

    # Convert the XML tree to a byte string.
    xml_output = tostring(xml_model)
    return xml_output


def deflate_and_base64_encode(string_val):
    """
    Helper function that compresses a string using zlib (deflate algorithm)
    and then encodes the compressed data using Base64.
    This is a required step for passing diagram data to Draw.io via URL.
    @param string_val: The input string (XML tree).
    @return: The Base64 encoded compressed string.
    """
    # Compress the string using zlib.
    zlibbed_str = compress(string_val)
    # Extract the actual compressed data, removing zlib header (2 bytes) and checksum (4 bytes).
    compressed_string = zlibbed_str[2:-4]
    # Base64 encode the compressed string.
    return b64encode(compressed_string)
