# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This module defines the visual styles and properties for different node types
(e.g., AWS resources, containers like VPCs, regions, accounts) and edges
used in generating Draw.io diagrams. It includes predefined styles and
dynamically loads additional SVG icons from an external source to enrich
the diagram's visual representation.
"""

from collections import defaultdict # Used to create a dictionary with a default factory.
import zipfile # Used for working with ZIP archives.
import urllib.request # Used for opening URLs (downloading files).
import tempfile # Used for creating temporary files and directories.
import os.path # Used for path manipulation (e.g., checking if a file exists).
from base64 import b64encode # Used for Base64 encoding SVG content.


def get_type_definitions():
    """
    Prepares and returns a dictionary of Draw.io type definitions, including styles,
    widths, and heights for various diagram elements. It initializes with a set
    of predefined styles and then attempts to download and integrate additional
    SVG icons from a remote ZIP file.
    @return: A defaultdict where keys are type names (e.g., 'vpc', 'ec2', 'lambda')
             and values are dictionaries containing 'style', 'width', and 'height'.
             If a type is not found, it returns a default icon style.
    """
    # URL where the perspective icon set (a collection of SVG icons) is hosted.
    perspective_icon_url = 'https://perspective-icon-svg-set.s3-eu-west-1.amazonaws.com/v2.0.0/perspective-icons.zip'
    perspective_zip = 'perspective-icons.zip'
    
    # Define a default AWS Resource Icon style and size for types not explicitly defined or found.
    default_icon = 'gradientDirection=north;outlineConnect=0;fontColor=#232F3E;gradientColor=#505863;fillColor=#1E262E;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=11;fontStyle=0;fontFamily=Tahoma;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.general;'
    default_icon_size = 43
    
    # Initial set of predefined styles for common diagram elements.
    # These styles are typically pulled from Draw.io's AWS shape library.
    type_definitions = {
        'account': {
            'style': 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=11;fontStyle=0;fontFamily=Tahoma;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;'
        },
        'availabilityZone': {
            'style' : 'fillColor=none;strokeColor=#147EBA;dashed=1;verticalAlign=top;fontSize=11;fontStyle=0;fontColor=#147EBA;fontFamily=Tahoma;'
        },
        'edge': {
            'style': 'html=1;endArrow=block;elbow=vertical;startArrow=none;endFill=1;strokeColor=#545B64;rounded=0;jumpStyle=gap;opacity=80;'
        },
        'region': {
            'style' : 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=11;fontStyle=0;fontFamily=Tahoma;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_region;strokeColor=#147EBA;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=0;'
        },
        'subnet': {
            'style' : 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=11;fontStyle=0;fontFamily=Tahoma;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#248814;fillColor=#E9F3E6;verticalAlign=top;align=left;spacingLeft=30;fontColor=#248814;dashed=0;'
        },
        'type': {
            'style' : 'fillColor=none;strokeColor=#5A6C86;dashed=1;verticalAlign=top;fontSize=11;fontStyle=0;fontColor=#5A6C86;fontFamily=Tahoma;'
        },
        'vpc': {
            'style' : 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=11;fontStyle=0;fontFamily=Tahoma;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;strokeColor=#248814;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#AAB7B8;dashed=0;'
        }
    }

    tmp = tempfile.gettempdir() # Get the system's temporary directory path.

    # If the zipped icon file does not exist in the temporary directory, download it.
    if not os.path.isfile(tmp + '/' + perspective_zip):
        with urllib.request.urlopen(perspective_icon_url) as dl_file: # nosec: This is a known, trusted URL for icons.
            with open(tmp + '/' + perspective_zip, 'wb') as out_file:
                out_file.write(dl_file.read())
    
    # Open the downloaded ZIP file.
    zipped_icons = zipfile.ZipFile(tmp + '/' + perspective_zip)
    # Iterate through each file in the ZIP archive.
    for i in range(len(zipped_icons.namelist())):
        icon_filename = zipped_icons.namelist()[i]
        # Process only SVG files.
        if (".svg" in icon_filename):
            # Extract the icon name from the filename (e.g., 'Arch_AWS-Cloud_64.svg' -> 'AWS-Cloud').
            icon_name = icon_filename[6:-4]
            # If the icon name is not already in the predefined type definitions.
            if icon_name not in type_definitions:
                svg = zipped_icons.read(icon_filename) # Read the SVG content.
                encoded_svg = b64encode(svg).decode() # Base64 encode the SVG content.
                # Construct the Draw.io style string for an image shape using the encoded SVG.
                style = 'shape=image;verticalLabelPosition=bottom;verticalAlign=top;fontSize=11;fontFamily=Tahoma;aspect=fixed;imageAspect=0;image=data:image/svg+xml,' + encoded_svg
                # Add the new icon style and default size to the type definitions.
                type_definitions[icon_name] = {'style' : style, 'width': default_icon_size, 'height': default_icon_size}

            
    # Create a defaultdict that returns the default icon style if a requested type is not found.
    types = defaultdict(lambda: {'style': default_icon, 'height': default_icon_size, 'width': default_icon_size}, type_definitions)
    
    return types
